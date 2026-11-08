import secrets
from typing import Self

from pydantic import Field, SecretStr, model_validator

from myschedule.domain.schedules import StrictModel


class PasswordLogin(StrictModel):
    identifier: str = Field(min_length=1, max_length=254)
    password: SecretStr = Field(min_length=1, max_length=128)


class PasswordEmail(StrictModel):
    email: str = Field(min_length=3, max_length=254)


class NewPassword(StrictModel):
    password: SecretStr = Field(min_length=8, max_length=128)
    confirmation: SecretStr = Field(min_length=8, max_length=128)

    @model_validator(mode="after")
    def matching_passwords(self) -> Self:
        if not secrets.compare_digest(
            self.password.get_secret_value().encode(), self.confirmation.get_secret_value().encode()
        ):
            raise ValueError("Password confirmation does not match")
        return self


class PasswordLinkUse(NewPassword):
    token: SecretStr = Field(min_length=43, max_length=43)


class PasswordChange(NewPassword):
    current_password: SecretStr = Field(min_length=1, max_length=128)


class PasswordContext(StrictModel):
    enabled: bool
    registration_open: bool
    csrf_token: str | None


class PasswordSecurity(StrictModel):
    enabled: bool
    password_active: bool
    username: str | None
    email: str | None


class PasswordMessage(StrictModel):
    message: str
