package app.usecase;

import app.annotations.ApplicationService;
import app.domain.User;
import app.domain.UserDraft;
import app.normalization.EmailNormalizer;
import app.normalization.NameNormalizer;
import app.ports.CreateUserInputPort;
import app.ports.UserRepositoryPort;
import app.validation.UserDraftValidator;

@ApplicationService
public class CreateUserUseCase extends AbstractUseCase<UserDraft, User> implements CreateUserInputPort {
    private final NameNormalizer nameNormalizer;
    private final EmailNormalizer emailNormalizer;
    private final UserDraftValidator validator;
    private final UserRepositoryPort repository;

    public CreateUserUseCase(
        NameNormalizer nameNormalizer,
        EmailNormalizer emailNormalizer,
        UserDraftValidator validator,
        UserRepositoryPort repository
    ) {
        this.nameNormalizer = nameNormalizer;
        this.emailNormalizer = emailNormalizer;
        this.validator = validator;
        this.repository = repository;
    }

    @Override
    public User execute(UserDraft draft) {
        validator.validate(draft);
        String normalizedName = nameNormalizer.normalize(draft.name());
        String normalizedEmail = emailNormalizer.normalize(draft.email());
        User user = User.create(normalizedName, normalizedEmail, draft.kind());
        return repository.save(user);
    }
}
