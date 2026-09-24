"""Camera directions become the single, global IN/OUT configuration: per-employee
camera assignments are removed.

Events held as `camera_not_assigned` were only held because of a missing
assignment; they move to `needs_review` so an administrator decides on them.

Revision ID: 0003
Revises: 0002
"""
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE recognition_events SET status = 'needs_review' WHERE status = 'camera_not_assigned'")
    op.drop_constraint("ck_events_status", "recognition_events", type_="check")
    op.create_check_constraint("ck_events_status", "recognition_events",
                               "status IN ('confirmed', 'needs_review', 'rejected', 'duplicate')")
    op.execute("UPDATE system_settings SET data = jsonb_set(data, '{attendance}', (data->'attendance') - 'requireCameraAssignment') "
               "WHERE data ? 'attendance'")
    op.drop_table("employee_camera_assignments")


def downgrade() -> None:
    op.create_table(
        "employee_camera_assignments",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("employee_id", sa.UUID(), nullable=False),
        sa.Column("camera_id", sa.UUID(), nullable=False),
        sa.Column("assignment_type", sa.String(length=5), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("assignment_type IN ('entry', 'exit')", name="ck_assignments_type"),
        sa.CheckConstraint("status IN ('active', 'inactive')", name="ck_assignments_status"),
        sa.ForeignKeyConstraint(["camera_id"], ["cameras.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("employee_id", "camera_id", "assignment_type", name="uq_assignment"),
    )
    op.create_index("ix_employee_camera_assignments_camera_id", "employee_camera_assignments", ["camera_id"])
    op.create_index("ix_employee_camera_assignments_employee_id", "employee_camera_assignments", ["employee_id"])
    op.drop_constraint("ck_events_status", "recognition_events", type_="check")
    op.create_check_constraint("ck_events_status", "recognition_events",
                               "status IN ('confirmed', 'needs_review', 'rejected', 'duplicate', 'camera_not_assigned')")
