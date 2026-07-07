package app.adapters;

import app.annotations.Adapter;
import app.domain.User;
import app.ports.UserRepositoryPort;

@Adapter("audit")
public class AuditUserRepository implements UserRepositoryPort {
    @Override
    public User save(User user) {
        audit(user);
        return user;
    }

    private void audit(User user) {
        user.email();
    }
}
