package app.domain;

/** Application sealed type fixture for future parser/index coverage. */
public sealed interface RegistrationState permits RegistrationState.Accepted, RegistrationState.Rejected {
    record Accepted(User user) implements RegistrationState {}
    record Rejected(String reason) implements RegistrationState {}
}
