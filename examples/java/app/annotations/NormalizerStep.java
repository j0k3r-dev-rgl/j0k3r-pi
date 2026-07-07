package app.annotations;

import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;

/** Application-owned normalization marker for repetitive pipelines. */
@Retention(RetentionPolicy.RUNTIME)
public @interface NormalizerStep {
    int order();
}
