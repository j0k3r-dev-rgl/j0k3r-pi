package app.validation;

/** Application-owned generic validator contract. */
public interface Validator<T> {
    void validate(T value);
}
