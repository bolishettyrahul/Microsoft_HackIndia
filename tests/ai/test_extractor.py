from __future__ import annotations

import json

from baton.ai.extractor import StructuredExtractor, strict_schema
from baton.interfaces.ai import ModelProfile
from baton.interfaces.errors import ModelUnavailable
from baton.interfaces.types import AlertCode, Completion


class _Model:
    def __init__(self, replies) -> None:
        self.replies = list(replies)
        self.calls = 0
        self._profile = ModelProfile(
            id="groq:extractor",
            label="extractor",
            provider="groq",
            model="extractor",
            base_url="https://example.test",
            burstable=True,
        )

    @property
    def profile(self) -> ModelProfile:
        return self._profile

    def complete(self, messages, *, max_tokens=None, json_schema=None) -> Completion:
        value = self.replies[self.calls]
        self.calls += 1
        if isinstance(value, BaseException):
            raise value
        return Completion(text=value, model_id=self.profile.id, latency_ms=1)


def test_strict_schema_requires_every_field_and_forbids_extras() -> None:
    schema = strict_schema()
    raw_item = schema["$defs"]["_RawItem"]
    assert raw_item["additionalProperties"] is False
    assert set(raw_item["required"]) == set(raw_item["properties"])
    assert "anyOf" not in json.dumps(schema)
    assert raw_item["properties"]["reason"]["type"] == ["string", "null"]
    assert None in raw_item["properties"]["check_id"]["enum"]


def test_extractor_retries_invalid_json_and_normalises_aliases() -> None:
    valid = json.dumps(
        {
            "items": [
                {
                    "kind": "rejection",
                    "text": "Redis",
                    "reason": "free tier",
                    "aliases": ["redis", " Redis cache ", "Redis cache"],
                    "check_id": None,
                    "target": None,
                }
            ]
        }
    )
    model = _Model(["not-json", valid])
    extractor = StructuredExtractor([model])

    result = extractor.extract(user_msg="No Redis", reply="Okay", contract_text="")

    assert model.calls == 2
    assert result.extractor_model == "groq:extractor"
    assert result.items[0].text == "Redis"
    assert result.items[0].aliases == ("Redis cache",)


def test_extractor_never_raises_when_models_are_unavailable() -> None:
    model = _Model([ModelUnavailable("groq:extractor", "auth", "bad key")])
    result = StructuredExtractor([model]).extract(user_msg="hello", reply="hi", contract_text="")
    assert result.items == ()
    assert result.alerts[0].code == AlertCode.EXTRACTION_FAILED


def test_extractor_restores_explicit_rejection_omitted_by_model() -> None:
    model = _Model(
        [
            json.dumps(
                {
                    "items": [
                        {
                            "kind": "constraint",
                            "text": "Must stay on the free tier",
                            "reason": None,
                            "aliases": [],
                            "check_id": None,
                            "target": None,
                        },
                        {
                            "kind": "decision",
                            "text": "Use an in-process cache",
                            "reason": None,
                            "aliases": [],
                            "check_id": None,
                            "target": None,
                        },
                    ]
                }
            )
        ]
    )

    result = StructuredExtractor([model]).extract(
        user_msg="No Redis, we're on a free tier; use an in-process cache.",
        reply="Understood.",
        contract_text="Goal: add caching",
    )

    rejection = next(item for item in result.items if item.kind == "rejection")
    assert rejection.text == "Redis"
    assert rejection.reason == "we're on a free tier"
