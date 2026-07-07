package app.normalization;

import app.annotations.NormalizerStep;

@NormalizerStep(order = 2)
public class EmailNormalizer implements Normalizer<String> {
    @Override
    public String normalize(String value) {
        return value == null ? "" : value.trim().toLowerCase();
    }
}
