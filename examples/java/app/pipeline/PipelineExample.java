package app.pipeline;

/** Application-owned lambda, method-reference, and fluent-chain fixture. */
public class PipelineExample {
    public String run(String input) {
        return new TaskPipeline<String>()
            .add(value -> normalize(value))
            .add(this::decorate)
            .execute(input);
    }

    private String normalize(String value) {
        return value.trim();
    }

    private String decorate(String value) {
        return "[" + value + "]";
    }
}
