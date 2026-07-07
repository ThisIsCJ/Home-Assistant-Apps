# Changelog

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
