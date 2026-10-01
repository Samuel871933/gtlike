"""Create or extend the 9-row by 6-column design gallery on the local speed world."""

import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


DB = Path(os.environ.get("SQLITE_STORAGE", "data/game.sqlite"))
ORIGIN_X, ORIGIN_Y = 510, 510
DESIGNS = (
    ("beige", "ApercuBeige", "Beige"),
    ("blanc-bleu", "ApercuBlancBleu", "Blanc Bleu"),
    ("noir", "ApercuNoir", "Noir"),
    ("viking", "ApercuViking", "Viking"),
    ("rome-antique", "ApercuRome", "Rome"),
    ("egyptien", "ApercuEgypte", "Egypte"),
    ("futuriste", "ApercuFuturiste", "Futuriste"),
    ("grece-antique", "ApercuGrece", "Grece"),
    ("arabo-musulman", "ApercuAraboMusulman", "Empire Arabo"),
)
STAGES = ((0, 299, 150), (300, 999, 650), (1000, 2999, 2000),
          (3000, 5999, 4500), (6000, 8999, 7500), (9000, 999999, 9800))


def grant_showcase_design(db, user_id, design, world_id, now):
    """Keep test accounts compatible with the shop's per-world design rights."""
    if design == "beige":
        return 0
    if db.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'Entitlements'").fetchone() is None:
        return 0  # The shop migration will grant legacy rights when it runs.
    owned = db.execute(
        "SELECT 1 FROM Entitlements WHERE userId = ? AND itemKey = ? "
        "AND (scope = 'account' OR (scope = 'world' AND worldId = ?)) "
        "AND startsAt <= ? AND (endsAt IS NULL OR endsAt > ?) LIMIT 1",
        (user_id, f"design:{design}", world_id, now, now),
    ).fetchone()
    if owned:
        return 0
    db.execute(
        "INSERT INTO Entitlements (userId, worldId, scope, itemKey, offerId, startsAt, endsAt, "
        "price, source, createdAt, updatedAt) VALUES (?, ?, 'world', ?, NULL, ?, NULL, 0, 'showcase', ?, ?)",
        (user_id, world_id, f"design:{design}", now, now, now),
    )
    return 1


def main():
    if not DB.is_file():
        raise SystemExit(f"Base locale introuvable : {DB}")
    db = sqlite3.connect(DB, timeout=30)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    try:
        db.execute("BEGIN IMMEDIATE")
        world = db.execute("SELECT id FROM Worlds WHERE slug = 'speed'").fetchone()
        if world is None:
            raise ValueError("Monde rapide de test introuvable")
        world_id = world["id"]

        usernames = [row[1] for row in DESIGNS]
        existing = db.execute(
            f"SELECT id, username, email, villageDesign FROM Users WHERE username IN ({','.join('?' for _ in usernames)})",
            usernames,
        ).fetchall()
        by_username = {row["username"]: row for row in existing}

        templates = []
        for minimum, maximum, target in STAGES:
            row = db.execute(
                "SELECT points, buildings FROM Villages WHERE worldId = ? "
                "AND points BETWEEN ? AND ? ORDER BY ABS(points - ?) LIMIT 1",
                (world_id, minimum, maximum, target),
            ).fetchone()
            if row is None:
                raise ValueError(f"Aucun village modèle pour l'étape {len(templates) + 1}")
            templates.append(row)

        bot = db.execute("SELECT passwordHash FROM Users WHERE email LIKE '%@bots.adarma.local' LIMIT 1").fetchone()
        if bot is None:
            raise ValueError("Aucun compte fictif dont réutiliser le mot de passe de test")
        now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3] + " +00:00"

        created = 0
        granted = 0
        for row_index, (design, username, label) in enumerate(DESIGNS):
            y = ORIGIN_Y + row_index
            previous = by_username.get(username)
            if previous:
                player = db.execute(
                    "SELECT id FROM Players WHERE userId = ? AND worldId = ?",
                    (previous["id"], world_id),
                ).fetchone()
                villages = [] if player is None else db.execute(
                    "SELECT x, y, points FROM Villages WHERE playerId = ? ORDER BY x",
                    (player["id"],),
                ).fetchall()
                if (previous["email"] != username.lower() + "@showcase.adarma.local"
                        or previous["villageDesign"] != design or len(villages) != 6
                        or any((v["x"], v["y"]) != (ORIGIN_X + i, y)
                               or not (STAGES[i][0] <= v["points"] <= STAGES[i][1])
                               for i, v in enumerate(villages))):
                    raise ValueError(f"Ligne existante incohérente : {username}")
                granted += grant_showcase_design(db, previous["id"], design, world_id, now)
                continue

            occupied = db.execute(
                "SELECT x FROM Villages WHERE worldId = ? AND y = ? AND x BETWEEN ? AND ?",
                (world_id, y, ORIGIN_X, ORIGIN_X + 5),
            ).fetchone()
            if occupied:
                raise ValueError(f"La ligne y={y} est déjà occupée")
            user_id = db.execute(
                "INSERT INTO Users (username, email, passwordHash, villageDesign, createdAt, updatedAt) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (username, username.lower() + "@showcase.adarma.local", bot["passwordHash"], design, now, now),
            ).lastrowid
            total = sum(template["points"] for template in templates)
            player_id = db.execute(
                "INSERT INTO Players (name, userId, worldId, points, villageCount, createdAt, updatedAt) "
                "VALUES (?, ?, ?, ?, 6, ?, ?)",
                (username, user_id, world_id, total, now, now),
            ).lastrowid
            for stage_index, template in enumerate(templates):
                x = ORIGIN_X + stage_index
                db.execute(
                    "INSERT INTO Villages (name, x, y, isFirst, buildings, units, wood, stone, iron, "
                    "resourcesAt, points, createdAt, updatedAt, worldId, playerId) "
                    "VALUES (?, ?, ?, ?, ?, '{}', 0, 0, 0, ?, ?, ?, ?, ?, ?)",
                    (f"{label} N{stage_index + 1}", x, y, int(stage_index == 0),
                     template["buildings"], now, template["points"], now, now, world_id, player_id),
                )
            granted += grant_showcase_design(db, user_id, design, world_id, now)
            created += 1
        db.commit()
        print(f"Galerie du monde speed : {created} joueur(s) ajouté(s), {granted} droit(s) accordé(s), {len(DESIGNS)} lignes × 6 villages.")
        print(f"Grille : x={ORIGIN_X}…{ORIGIN_X + 5}, y={ORIGIN_Y}…{ORIGIN_Y + len(DESIGNS) - 1}.")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
