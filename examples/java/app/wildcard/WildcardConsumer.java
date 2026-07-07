package app.wildcard;

import app.normalization.*;

/** Application-owned wildcard import fixture. */
public class WildcardConsumer {
    private final NameNormalizer normalizer = new NameNormalizer();

    public String consume(String value) {
        return normalizer.normalize(value);
    }
}
