# Cookbook

A shared recipe organizer for your household, running as a Home Assistant
add-on. Import recipes from any recipe website, scale ingredients to the number
of servings you want, and leave star ratings and comments.

## Features

- **Web import** — paste a recipe URL and the add-on scrapes the title, image,
  ingredients and steps (via schema.org Recipe / JSON-LD metadata).
- **Ingredient scaling** — change the servings and quantities rescale live,
  with tidy fractions (½, ⅓, ¾ …).
- **Categories & tags** — organize recipes and filter/search the collection.
- **Ratings & comments** — every household member can review a recipe.
- **Markdown steps** with optional per-step images.
- **Multi-user aware** — recipes and reviews are attributed to the signed-in
  Home Assistant user (via ingress), and only the owner (or an admin) can edit
  or delete them.
- **Admin panel** — admins get an **Admin** button in the top bar where they
  can restrict cookbook access to all users or a selected set of users, and
  manage archived recipes. Deleting a recipe archives it rather than removing
  it; admins can restore archived recipes or permanently delete them.
- **Backup & transfer** — from the Admin page, **Export cookbook** downloads
  every recipe and its images as a single self-contained zip archive, and
  **Import cookbook** loads such a file into any instance (older JSON exports are
  still accepted). Import is additive: it never deletes or overwrites existing
  recipes (re-importing creates copies).

## Requirements

This add-on stores recipes in **MongoDB**. You need a reachable MongoDB server.
Any of these work:

- MongoDB Atlas (free tier is plenty)
- A self-hosted MongoDB / a MongoDB Home Assistant add-on
- AWS DocumentDB / Azure Cosmos DB (Mongo API)

## Configuration

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `mongo_uri` | **yes** | `""` | MongoDB connection string, e.g. `mongodb://user:pass@host:27017` or a `mongodb+srv://…` Atlas URI. |
| `mongo_db` | no | `cookbook` | Database name to use. |
| `everyone_is_admin` | no | `false` | When `true`, every user can edit/delete any recipe or review (household mode). |
| `admin_users` | no | `[]` | List of Home Assistant usernames (or display names) allowed to edit/delete anything. |

Example:

```yaml
mongo_uri: "mongodb://192.168.1.50:27017"
mongo_db: cookbook
everyone_is_admin: false
admin_users:
  - alice
```

After saving the configuration, **Start** the add-on and open the UI from the
sidebar (or the **Open Web UI** button).

## How it works

- The add-on is only reachable through Home Assistant **ingress**, so Home
  Assistant handles authentication. The signed-in user's identity is read from
  the ingress headers and used for recipe ownership and reviews.
- Recipes are stored in the `cookbookRecipes` collection of your MongoDB
  database. Deleted recipes stay there flagged as archived until an admin
  permanently deletes them from the admin panel. Access settings and the list
  of known users live in the `cookbookConfig` and `cookbookUsers` collections.
- Uploaded images are stored on the add-on's `/data` volume and served back
  through ingress.

## Troubleshooting

- **The page loads but says "Database not connected" / recipes fail with 503** —
  check `mongo_uri`. The add-on log (Log tab) prints the masked URI and the
  connection error. Make sure the MongoDB host is reachable from the Home
  Assistant host and any credentials are correct.
- **Import fails on a specific site** — not all sites publish structured recipe
  metadata; you can still add the recipe manually.

## Data & privacy

All recipe data lives in the MongoDB database you configure. Uploaded images
live in the add-on's `/data` directory (part of your Home Assistant backups).
