package app.adapters;

import app.annotations.Adapter;
import app.domain.User;
import app.ports.UserRepositoryPort;

import java.util.ArrayList;
import java.util.List;

@Adapter("memory")
public class InMemoryUserRepository implements UserRepositoryPort {
    private final List<User> users = new ArrayList<>();

    @Override
    public User save(User user) {
        users.add(user);
        return user;
    }
}
