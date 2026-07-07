package app.pipeline;

import java.util.ArrayList;
import java.util.List;

/** Application-owned fluent builder and callback fixture. */
public class TaskPipeline<T> {
    private final List<Task<T>> tasks = new ArrayList<>();

    public TaskPipeline<T> add(Task<T> task) {
        tasks.add(task);
        return this;
    }

    public T execute(T value) {
        T current = value;
        for (Task<T> task : tasks) {
            current = task.run(current);
        }
        return current;
    }
}
