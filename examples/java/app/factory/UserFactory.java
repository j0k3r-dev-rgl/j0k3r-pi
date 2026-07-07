package app.factory;

import app.adapters.InMemoryUserRepository;
import app.normalization.EmailNormalizer;
import app.normalization.NameNormalizer;
import app.ports.CreateUserInputPort;
import app.ports.UserRepositoryPort;
import app.usecase.CreateUserUseCase;
import app.validation.UserDraftValidator;

/** Application-owned provider/factory fixture. */
public class UserFactory {
    public CreateUserInputPort createUseCase() {
        UserRepositoryPort repository = createRepository();
        return new CreateUserUseCase(
            new NameNormalizer(),
            new EmailNormalizer(),
            new UserDraftValidator(),
            repository
        );
    }

    private UserRepositoryPort createRepository() {
        return new InMemoryUserRepository();
    }
}
