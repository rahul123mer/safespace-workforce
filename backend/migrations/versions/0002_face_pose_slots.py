"""Face registration pose slots: front (required), left and right (optional).

Revision ID: 0002
Revises: 0001
"""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("face_registrations", sa.Column("pose_slot", sa.String(length=5), nullable=False, server_default="front"))
    op.create_check_constraint("ck_face_registrations_pose_slot", "face_registrations", "pose_slot IN ('front', 'left', 'right')")
    op.create_index("ix_face_registrations_slot", "face_registrations", ["employee_id", "pose_slot", "status"])


def downgrade() -> None:
    op.drop_index("ix_face_registrations_slot", table_name="face_registrations")
    op.drop_constraint("ck_face_registrations_pose_slot", "face_registrations", type_="check")
    op.drop_column("face_registrations", "pose_slot")
