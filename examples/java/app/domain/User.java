package app.domain;

/** Application entity fixture. */
public class User {
    private final String name;
    private final String email;
    private final UserKind kind;

    private User(String name, String email, UserKind kind) {
        this.name = name;
        this.email = email;
        this.kind = kind;
    }

    public static User create(String name, String email, UserKind kind) {
        return new User(name, email, kind);
    }

    public String name() {
        return name;
    }

    public String email() {
        return email;
    }

    public UserKind kind() {
        return kind;
    }
}
