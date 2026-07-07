/**
 * Java fixture for find_references callback and method-reference cases.
 */

public class CallbackExamples {
    interface Runner {
        void run();
    }

    private void helper() {}

    private void consume(Runner runner) {
        runner.run();
    }

    public void run() {
        consume(() -> helper());
        consume(this::helper);
    }
}
