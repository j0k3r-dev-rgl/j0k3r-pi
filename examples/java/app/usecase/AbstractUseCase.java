package app.usecase;

/** Application-owned abstract workflow fixture. */
public abstract class AbstractUseCase<I, O> {
    public final O handle(I input) {
        before(input);
        return execute(input);
    }

    protected void before(I input) {}

    protected abstract O execute(I input);
}
