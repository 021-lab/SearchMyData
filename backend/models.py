"""Pydantic request/response models for the workspace API."""
from typing import Any, Literal
from pydantic import BaseModel, Field


class SearchRequest(BaseModel):
    query: str = ""


class ActionRequest(BaseModel):
    project_id: str = "main"
    author_type: str = "usr"
    type: Literal["add_node", "patch", "reorder"]
    payload: Any  # structure depends on `type`


class UndoRequest(BaseModel):
    project_id: str = "main"
    author_type: str = "usr"
