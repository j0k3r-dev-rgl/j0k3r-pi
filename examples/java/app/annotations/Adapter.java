package app.annotations;

import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;

/** Application-owned adapter stereotype. */
@Retention(RetentionPolicy.RUNTIME)
public @interface Adapter {
    String value() default "";
}
