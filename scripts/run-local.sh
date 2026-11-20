#!/usr/bin/env bash
set -Eeuo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

stage="checking prerequisites"
fail() {
    local status=$?
    trap - ERR
    printf '\nFailed while %s (exit %s). Fix the error above, then rerun this script.\n' "$stage" "$status" >&2
    if [[ "$stage" == "waiting for pods" ]]; then
        kubectl --context=minikube -n task-board get pods -o wide >&2 || true
        kubectl --context=minikube -n task-board get events --sort-by=.metadata.creationTimestamp >&2 || true
    fi
    exit "$status"
}
trap fail ERR

for tool in docker minikube kubectl; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "Required command is missing: $tool" >&2
        exit 1
    fi
done

if ! docker info >/dev/null 2>&1; then
    echo "Docker is unavailable. Start Docker and ensure your user can access it, then rerun this script." >&2
    exit 1
fi

stage="starting Minikube"
minikube start -p minikube --driver=docker

# Build using Docker, then explicitly transfer images into Minikube's image store.
# The Docker build contexts exclude .env files via their allowlist .dockerignore.
for component in backend frontend; do
    image="tasks-${component}:local"
    stage="building $image"
    printf '\nBuilding %s...\n' "$image"
    docker build --tag "$image" "./$component"

    stage="loading $image into Minikube"
    minikube -p minikube image load --daemon --overwrite=true "$image"

done

stage="verifying Minikube images"
images="$(minikube -p minikube image ls --format=short)"
for expected in tasks-backend:local tasks-frontend:local; do
    found=false
    while IFS= read -r entry; do
        case "$entry" in
            "$expected"|*/"$expected") found=true; break ;;
        esac
    done <<< "$images"
    if [[ "$found" != true ]]; then
        printf 'Image %s was not found inside Minikube. Deployment aborted.\n' "$expected" >&2
        printf 'Minikube reported these images:\n%s\n' "$images" >&2
        exit 1
    fi
done

stage="configuring database Secret"
# kubectl imports the file at runtime; never print or commit the generated Secret.
kubectl --context=minikube create namespace task-board --dry-run=client -o yaml | kubectl --context=minikube apply -f -
kubectl --context=minikube -n task-board create secret generic database --from-env-file=backend/.env --dry-run=client -o yaml | kubectl --context=minikube apply -f -
# Retain the old database volume, but remove the obsolete local database workload.
kubectl --context=minikube -n task-board delete deployment/postgres service/postgres --ignore-not-found

stage="deploying the app"
kubectl --context=minikube apply -f k8s/local.yaml
# Restart existing pods too, so rerunning uses the freshly loaded images.
kubectl --context=minikube -n task-board rollout restart deployment/backend deployment/frontend
stage="waiting for pods"
for deployment in backend frontend; do
    kubectl --context=minikube -n task-board rollout status "deployment/$deployment" --timeout=300s
done
kubectl --context=minikube -n task-board get pods

printf '\nOpen http://localhost:8081. Keep this terminal open.\nCtrl+C stops forwarding; application pods remain running.\n'
stage="forwarding localhost:8081 (check that this port is free)"
kubectl --context=minikube -n task-board port-forward --address=127.0.0.1 service/frontend 8081:80
