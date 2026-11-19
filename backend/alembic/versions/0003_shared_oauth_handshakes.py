"""Add single-use, browser-bound OAuth state shared by serverless instances.

Revision ID: 0003
Revises: 0002

Additive only: no existing users, credentials, sessions or account data are changed.
Deploy revision-compatible code to the original API before applying this migration.
"""

import sqlalchemy as sa

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "oauth_handshakes",
        sa.Column("state_hash", sa.String(64), primary_key=True),
        sa.Column("binding_hash", sa.String(64), nullable=False),
        sa.Column("encrypted_payload", sa.Text(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("expires_at > created_at", name="valid_lifetime"),
        schema="app_private",
    )
    op.create_index(
        "ix_oauth_handshakes_expires_at", "oauth_handshakes", ["expires_at"], schema="app_private"
    )
    table = "app_private.oauth_handshakes"
    op.execute(f"REVOKE ALL ON {table} FROM PUBLIC, myschedule_app, myschedule_worker")
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(f"GRANT SELECT, INSERT, DELETE ON {table} TO myschedule_auth")
    op.execute(
        f"CREATE POLICY auth_access ON {table} TO myschedule_auth USING (true) WITH CHECK (true)"
    )


def downgrade() -> None:
    # Operational code reversals keep the additive table; old credentials/data are untouched.
    op.drop_table("oauth_handshakes", schema="app_private")
