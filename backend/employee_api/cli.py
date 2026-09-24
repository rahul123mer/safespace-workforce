"""Operator commands.

    python -m employee_api.cli create-admin --email ADDRESS --name "FULL NAME"
        Creates the first administrator; the password is read from the terminal.
    python -m employee_api.cli pipeline-status
        Prints what the backend can see of the existing recognition pipeline.
"""
from __future__ import annotations

import argparse
import getpass
import json
import sys

from sqlalchemy import func, select


def _create_admin(email: str, name: str) -> int:
    from .db import new_session
    from .models import User
    from .security import hash_password, password_problem

    email = email.strip().lower()
    with new_session() as db:
        if db.scalar(select(User.id).where(func.lower(User.email) == email)):
            print(f"An account for {email} already exists.", file=sys.stderr)
            return 1
        password = getpass.getpass("Password for the new administrator: ")
        problem = password_problem(password)
        if problem:
            print(problem, file=sys.stderr)
            return 1
        if getpass.getpass("Repeat the password: ") != password:
            print("The passwords do not match.", file=sys.stderr)
            return 1
        db.add(User(email=email, full_name=name.strip(), role="administrator", is_active=True, password_hash=hash_password(password)))
        db.commit()
    print(f"Administrator {email} created.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m employee_api.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    admin = sub.add_parser("create-admin", help="create an administrator account")
    admin.add_argument("--email", required=True)
    admin.add_argument("--name", required=True)
    sub.add_parser("pipeline-status", help="show the recognition pipeline configuration")
    args = parser.parse_args(argv)
    if args.command == "create-admin":
        return _create_admin(args.email, args.name)
    from .pipeline.status import describe

    print(json.dumps(describe(), indent=2))
    return 0


def serve() -> None:
    import uvicorn

    uvicorn.run("employee_api.main:app", host="127.0.0.1", port=8030)


if __name__ == "__main__":
    raise SystemExit(main())
