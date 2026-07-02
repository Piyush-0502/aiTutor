from fastapi.testclient import TestClient

import backend.main as main


client = TestClient(main.app)


def test_runtime_health_missing_api_key(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    response = client.get("/health/runtime")
    assert response.status_code == 200

    payload = response.json()
    assert payload["ok"] is False
    assert payload["checks"]["gemini_api_key"]["ok"] is False


def test_runtime_health_live_checks_success(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")

    def fake_configure(api_key):
        assert api_key == "test-key"

    def fake_embed_content(model, content, task_type):
        assert model
        assert content
        assert task_type == "retrieval_query"
        return {"embedding": [0.1, 0.2, 0.3]}

    class FakeResponse:
        text = "OK"

    class FakeModel:
        def __init__(self, model_name):
            self.model_name = model_name

        def generate_content(self, prompt, generation_config=None):
            assert prompt
            assert generation_config is not None
            return FakeResponse()

    monkeypatch.setattr(main.genai, "configure", fake_configure)
    monkeypatch.setattr(main.genai, "embed_content", fake_embed_content)
    monkeypatch.setattr(main.genai, "GenerativeModel", FakeModel)

    response = client.get("/health/runtime?live_checks=true")
    assert response.status_code == 200

    payload = response.json()
    assert payload["ok"] is True
    assert payload["checks"]["gemini_api_key"]["ok"] is True
    assert payload["checks"]["embedding_call"]["ok"] is True

    model_checks = [k for k in payload["checks"].keys() if k.startswith("model_call:")]
    assert model_checks
    for check_name in model_checks:
        assert payload["checks"][check_name]["ok"] is True