"""
Tests for MCP food logging tools.

Run with:
  cd mcp && pytest tests/test_food_tools.py -v

These tests patch _get/_post so no live server is needed.
"""

import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, patch


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_food_item(name="Coffee with Half&Half", item_id="abc123", estimated=True, caffeine=150):
    return {
        "id": item_id,
        "name": name,
        "scope": "user",
        "estimated": estimated,
        "servingSize": {"amount": 20, "unit": "oz"},
        "nutritionPerServing": {
            "calories": 60,
            "proteinG": 1,
            "carbsG": 5,
            "fatG": 3,
            "fiberG": 0,
            "sugarG": 2,
            "sodiumMg": 40,
            "caffeineMg": caffeine,
        },
    }


def _make_food_log(food_name="Coffee with Half&Half", log_id="log1", meal_type="breakfast"):
    return {
        "id": log_id,
        "foodName": food_name,
        "foodItemId": "abc123",
        "quantity": 1,
        "mealType": meal_type,
        "nutritionSnapshot": {
            "calories": 60,
            "proteinG": 1,
            "carbsG": 5,
            "fatG": 3,
            "fiberG": 0,
            "sugarG": 2,
            "sodiumMg": 40,
            "caffeineMg": 150,
        },
    }


# ── search_food_items ─────────────────────────────────────────────────────────

class TestSearchFoodItems:
    @pytest.mark.asyncio
    async def test_returns_formatted_list(self):
        items = [_make_food_item()]
        with patch("server._get", new=AsyncMock(return_value=items)):
            from server import search_food_items
            result = await search_food_items("coffee")
        assert "Coffee with Half&Half" in result
        assert "abc123" in result
        assert "caffeine:150mg" in result
        assert "[estimated]" in result

    @pytest.mark.asyncio
    async def test_no_results(self):
        with patch("server._get", new=AsyncMock(return_value=[])):
            from server import search_food_items
            result = await search_food_items("xyzzy")
        assert "No food items found" in result

    @pytest.mark.asyncio
    async def test_limit_capped_at_50(self):
        with patch("server._get", new=AsyncMock(return_value=[])) as mock_get:
            from server import search_food_items
            await search_food_items("test", limit=999)
        call_params = mock_get.call_args[1]["params"]
        assert call_params["limit"] == 50


# ── log_food_entry ────────────────────────────────────────────────────────────

class TestLogFoodEntry:
    @pytest.mark.asyncio
    async def test_creates_new_item_when_not_found(self):
        """Unknown food → create new item with estimated=True, then log it."""
        new_item = _make_food_item(item_id="new1")
        log = _make_food_log(log_id="log99")

        with (
            patch("server._get", new=AsyncMock(return_value=[])),
            patch("server._post", new=AsyncMock(return_value=new_item)) as mock_post,
        ):
            from server import log_food_entry
            result = await log_food_entry(
                name="Coffee with Half&Half",
                serving_amount=20,
                serving_unit="oz",
            )
        # First _post call creates the food item
        create_call = mock_post.call_args_list[0]
        assert create_call[0][0] == "/food/items"
        assert create_call[0][1]["estimated"] is True
        assert "[nutrition unknown" in result

    @pytest.mark.asyncio
    async def test_reuses_existing_item_on_exact_name_match(self):
        """Exact name match → reuse item, do NOT create a new one."""
        existing = [_make_food_item(name="Oatmeal", item_id="oat1", estimated=False, caffeine=0)]
        log = {**_make_food_log(food_name="Oatmeal", log_id="logX", meal_type="breakfast"),
               "nutritionSnapshot": {"calories": 150, "caffeineMg": 0, **{}}}

        with (
            patch("server._get", new=AsyncMock(return_value=existing)),
            patch("server._post", new=AsyncMock(return_value=log)) as mock_post,
        ):
            from server import log_food_entry
            result = await log_food_entry(name="Oatmeal")

        # Only one _post call — the food log, not an item creation
        assert mock_post.call_count == 1
        assert mock_post.call_args[0][0] == "/food/logs"
        assert "[nutrition unknown" not in result

    @pytest.mark.asyncio
    async def test_nutrition_provided_forces_new_item(self):
        """Even when a match exists, explicit nutrition creates a new item."""
        existing = [_make_food_item(name="Coffee", item_id="cof1", estimated=False)]
        new_item = _make_food_item(item_id="cof2", estimated=False)
        log = _make_food_log(log_id="logZ")

        with (
            patch("server._get", new=AsyncMock(return_value=existing)),
            patch("server._post", new=AsyncMock(side_effect=[new_item, log])) as mock_post,
        ):
            from server import log_food_entry
            await log_food_entry(name="Coffee", calories=5, caffeine_mg=95)

        assert mock_post.call_count == 2
        create_call = mock_post.call_args_list[0]
        assert create_call[0][0] == "/food/items"
        nutrition = create_call[0][1]["nutritionPerServing"]
        assert nutrition["calories"] == 5
        assert nutrition["caffeineMg"] == 95
        assert create_call[0][1]["estimated"] is False

    @pytest.mark.asyncio
    async def test_coffee_with_half_and_half_20oz_uses_food_log(self):
        """The canonical broken case: coffee beverage must land in food logs, not health readings."""
        new_item = _make_food_item(item_id="cof3")
        log = _make_food_log(log_id="logCoffee")

        post_calls = []

        async def fake_post(path, body):
            post_calls.append((path, body))
            return new_item if path == "/food/items" else log

        with (
            patch("server._get", new=AsyncMock(return_value=[])),
            patch("server._post", new=AsyncMock(side_effect=fake_post)),
        ):
            from server import log_food_entry
            result = await log_food_entry(
                name="Coffee with Half&Half 20oz",
                serving_amount=20,
                serving_unit="oz",
            )

        paths = [p for p, _ in post_calls]
        assert "/food/items" in paths, "Should create a food item"
        assert "/food/logs" in paths, "Should create a food log"
        assert "/stats/readings" not in paths, "Must NOT log to health readings"
        assert "Coffee" in result

    @pytest.mark.asyncio
    async def test_meal_type_auto_detected(self):
        """meal_type='' should be filled in, not sent blank."""
        new_item = _make_food_item()
        log = _make_food_log()

        with (
            patch("server._get", new=AsyncMock(return_value=[])),
            patch("server._post", new=AsyncMock(side_effect=[new_item, log])) as mock_post,
        ):
            from server import log_food_entry
            await log_food_entry(name="Banana", meal_type="")

        log_body = mock_post.call_args_list[1][0][1]
        assert log_body["mealType"] in ("breakfast", "lunch", "dinner", "snack", "other")
        assert log_body["mealType"] != ""

    @pytest.mark.asyncio
    async def test_explicit_meal_type_preserved(self):
        new_item = _make_food_item()
        log = _make_food_log()

        with (
            patch("server._get", new=AsyncMock(return_value=[])),
            patch("server._post", new=AsyncMock(side_effect=[new_item, log])) as mock_post,
        ):
            from server import log_food_entry
            await log_food_entry(name="Salad", meal_type="lunch")

        log_body = mock_post.call_args_list[1][0][1]
        assert log_body["mealType"] == "lunch"


# ── get_food_log ──────────────────────────────────────────────────────────────

class TestGetFoodLog:
    @pytest.mark.asyncio
    async def test_groups_by_meal(self):
        logs = [
            {**_make_food_log("Eggs", "l1", "breakfast"), "quantity": 2},
            {**_make_food_log("Sandwich", "l2", "lunch"), "quantity": 1},
        ]
        with patch("server._get", new=AsyncMock(return_value=logs)):
            from server import get_food_log
            result = await get_food_log("2025-05-24")

        assert "Breakfast:" in result
        assert "Lunch:" in result
        assert "Eggs" in result
        assert "Sandwich" in result

    @pytest.mark.asyncio
    async def test_no_entries(self):
        with patch("server._get", new=AsyncMock(return_value=[])):
            from server import get_food_log
            result = await get_food_log("2025-01-01")
        assert "No food logged" in result

    @pytest.mark.asyncio
    async def test_shows_caffeine_when_nonzero(self):
        log = _make_food_log("Coffee", "l1", "breakfast")
        with patch("server._get", new=AsyncMock(return_value=[log])):
            from server import get_food_log
            result = await get_food_log("2025-05-24")
        assert "caffeine" in result.lower()


# ── get_nutrition_summary ─────────────────────────────────────────────────────

class TestGetNutritionSummary:
    @pytest.mark.asyncio
    async def test_formats_totals(self):
        data = {
            "date": "2025-05-24",
            "logCount": 3,
            "totals": {
                "calories": 1850,
                "proteinG": 90.5,
                "carbsG": 210.0,
                "fatG": 65.0,
                "fiberG": 28.0,
                "sugarG": 55.0,
                "sodiumMg": 2100.0,
                "caffeineMg": 245.0,
            },
            "meals": {},
        }
        with patch("server._get", new=AsyncMock(return_value=data)):
            from server import get_nutrition_summary
            result = await get_nutrition_summary("2025-05-24")

        assert "1850 kcal" in result
        assert "90.5 g" in result
        assert "245 mg" in result

    @pytest.mark.asyncio
    async def test_no_entries(self):
        data = {"date": "2025-01-01", "logCount": 0, "totals": {}, "meals": {}}
        with patch("server._get", new=AsyncMock(return_value=data)):
            from server import get_nutrition_summary
            result = await get_nutrition_summary("2025-01-01")
        assert "No food logged" in result
