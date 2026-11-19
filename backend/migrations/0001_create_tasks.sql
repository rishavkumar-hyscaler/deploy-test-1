CREATE TABLE tasks (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL CHECK (length(trim(title)) > 0),
    completed BOOLEAN NOT NULL DEFAULT FALSE
);
