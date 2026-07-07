package app.ports;

import app.domain.User;
import app.domain.UserDraft;

/** Application-owned input port. */
public interface CreateUserInputPort {
    User execute(UserDraft draft);
}
