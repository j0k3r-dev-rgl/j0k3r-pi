package app.normalization;

import app.annotations.NormalizerStep;

@NormalizerStep(order = 1)
public class NameNormalizer implements Normalizer<String> {
    @Override
    public String normalize(String value) {
        return value == null ? "" : value.trim();
    }
}
