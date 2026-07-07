package app.web;

import app.domain.User;
import app.domain.UserDraft;
import app.domain.UserKind;
import app.factory.UserFactory;
import app.ports.CreateUserInputPort;

/** Application-owned entrypoint fixture. */
public class UserController {
    private final CreateUserInputPort createUser;

    public UserController(CreateUserInputPort createUser) {
        this.createUser = createUser;
    }

    public static UserController boot() {
        UserFactory factory = new UserFactory();
        return new UserController(factory.createUseCase());
    }

    public User handle(String name, String email) {
        UserDraft draft = new UserDraft(name, email, UserKind.EXTERNAL);
        return createUser.execute(draft);
    }
}
