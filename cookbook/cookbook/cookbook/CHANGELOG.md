# Changelog

## 1.2.0

- New admin panel (Admin button in the top bar, visible to admins only) with:
  - Cookbook access control — allow all Home Assistant users or only selected
    users. Users appear in the list after opening the cookbook once; admins
    always have access.
  - Archived recipes — deleting a recipe now archives it instead of removing
    it. Admins can restore archived recipes or permanently delete them.
- Recipe detail: fixed blank page, added a back button.
- Recipe browsing: 3-across card layout on Samsung Fold–width screens (~836px).

## 1.0.0

- Initial release as a Home Assistant add-on, converted from the Cookbook
  module of the Atlas app.
- React UI + Express API bundled in a single container, served through Home
  Assistant ingress.
- Authentication replaced with Home Assistant ingress identity (recipe/review
  ownership follows the signed-in HA user); `everyone_is_admin` and
  `admin_users` options for edit permissions.
- MongoDB connection configured through add-on options (`mongo_uri`,
  `mongo_db`).
- Image uploads stored on the `/data` volume.
- Features carried over: web recipe import (JSON-LD scraping), ingredient
  scaling, categories/tags, star ratings and comments, Markdown steps.
