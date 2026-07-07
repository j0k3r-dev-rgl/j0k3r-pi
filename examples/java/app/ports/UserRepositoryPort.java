package app.ports;

import app.domain.User;

/** Application-owned output port. */
public interface UserRepositoryPort {
    User save(User user);
}
