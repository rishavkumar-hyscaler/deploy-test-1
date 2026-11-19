FROM rust:1-bookworm AS build
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY migrations ./migrations
RUN cargo build --release --locked

FROM debian:bookworm-slim
WORKDIR /app
COPY --from=build /app/target/release/tasks-api /usr/local/bin/tasks-api
USER 10001:10001
EXPOSE 8080
CMD ["tasks-api"]
