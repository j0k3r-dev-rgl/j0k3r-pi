package app.normalization;

/** Application-owned generic normalizer contract. */
public interface Normalizer<T> {
    T normalize(T value);
}
