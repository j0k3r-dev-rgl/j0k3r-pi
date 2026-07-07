package app.validation;

import app.domain.UserDraft;

public class UserDraftValidator implements Validator<UserDraft> {
    @Override
    public void validate(UserDraft draft) {
        requirePresent(draft.name());
        requirePresent(draft.email());
    }

    private void requirePresent(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("value is required");
        }
    }
}
