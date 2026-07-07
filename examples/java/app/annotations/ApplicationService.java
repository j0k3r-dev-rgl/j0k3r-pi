package app.annotations;

import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;

/** Marker annotation owned by the application, not by a framework. */
@Retention(RetentionPolicy.RUNTIME)
public @interface ApplicationService {}
