package app.pipeline;

/** Application-owned callback contract. */
public interface Task<T> {
    T run(T value);
}
