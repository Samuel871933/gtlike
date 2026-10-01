'use strict';

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const config = require('../config');
const GameError = require('./GameError');

// Images de profil (joueurs et tribus), comme le blason de Guerre Tribale : seule une copie WebP réduite à la
// largeur des colonnes des profils est gardée, l'original n'est jamais écrit sur le disque.
const MAX_WIDTH = 360;
const MAX_HEIGHT = 240;
const MAX_BYTES = 5 * 1024 * 1024;
const DIR = path.resolve(config.uploadsDir, 'avatars');
const NAME_RE = /^[a-z]+-\d+-[0-9a-f]{8}\.webp$/;
// Changements d'image traités un par un dans le processus (rares) : SQLite n'a qu'une connexion.
let chain = Promise.resolve();

class ImageService {
  /** Réduit l'image (sans l'agrandir), la redresse selon l'EXIF puis la convertit en WebP sans métadonnées. */
  static async toAvatar(buffer) {
    if (!buffer || !buffer.length) throw new GameError('Choisissez une image.');
    try {
      // Première image seulement pour les GIF animés ; garde-fou contre les images démesurées.
      return await sharp(buffer, { limitInputPixels: 50e6 })
        .rotate()
        .resize({ width: MAX_WIDTH, height: MAX_HEIGHT, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 78, effort: 6 })
        .toBuffer();
    } catch {
      throw new GameError("Ce fichier n'est pas une image lisible (JPEG, PNG, WebP ou GIF).");
    }
  }

  /** Enregistre l'image d'un joueur ou d'une tribu ; le nom change à chaque envoi (cache des navigateurs). */
  static async saveAvatar(kind, id, buffer) {
    const data = await ImageService.toAvatar(buffer);
    const name = `${kind}-${Number(id)}-${crypto.randomBytes(4).toString('hex')}.webp`;
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(path.join(DIR, name), data);
    return name;
  }

  /** Supprime un fichier d'image (sans erreur s'il n'existe plus). */
  static async remove(name) {
    if (!name || !NAME_RE.test(name)) return;
    await fs.unlink(path.join(DIR, name)).catch(() => {});
  }

  /**
   * Remplace (ou retire, sans `buffer`) l'image d'un enregistrement Player ou Tribe. Le nouveau fichier est écrit
   * avant la mise à jour ; l'ancien nom est relu dans la transaction (verrou de ligne), pour que deux envois
   * simultanés ne laissent pas de fichier orphelin, puis supprimé après validation. Si la mise à jour échoue (ou si
   * l'enregistrement a disparu entre-temps, tribu dissoute par exemple), c'est le nouveau fichier qui est supprimé.
   */
  static replaceAvatar(record, kind, buffer) {
    const run = chain.then(() => ImageService.replaceAvatarNow(record, kind, buffer));
    chain = run.catch(() => {});
    return run;
  }

  static async replaceAvatarNow(record, kind, buffer) {
    const Model = record.constructor;
    const name = buffer ? await ImageService.saveAvatar(kind, record.id, buffer) : null;
    let old;
    try {
      old = await Model.sequelize.transaction(async (t) => {
        const fresh = await Model.findByPk(record.id, { attributes: ['id', 'avatar'], lock: t.LOCK.UPDATE, transaction: t });
        if (!fresh) throw new GameError('Introuvable.', 404);
        const previous = fresh.avatar;
        await fresh.update({ avatar: name }, { transaction: t });
        return previous;
      });
    } catch (err) {
      await ImageService.remove(name);
      throw err;
    }
    record.avatar = name;
    if (old !== name) await ImageService.remove(old);
    return name;
  }

  /**
   * Filet de sécurité : supprime du dossier tout fichier qu'aucun joueur ni aucune tribu ne référence (arrêt du
   * serveur entre l'écriture et la mise à jour, suppression en masse sans passer par les services…). Les fichiers
   * récents sont épargnés : ils peuvent appartenir à un envoi en cours.
   */
  static async sweepOrphans({ graceMs = 60 * 60000, now = Date.now() } = {}) {
    const { Player, Tribe } = require('../models');
    const { Op } = require('sequelize');
    let files;
    try {
      files = await fs.readdir(DIR);
    } catch {
      return 0;
    }
    const where = { avatar: { [Op.ne]: null } };
    const used = new Set([
      ...(await Player.findAll({ where, attributes: ['avatar'], raw: true })).map((r) => r.avatar),
      ...(await Tribe.findAll({ where, attributes: ['avatar'], raw: true })).map((r) => r.avatar),
    ]);
    let removed = 0;
    for (const file of files) {
      if (used.has(file)) continue;
      const full = path.join(DIR, file);
      const stat = await fs.stat(full).catch(() => null);
      if (!stat || !stat.isFile() || now - stat.mtimeMs < graceMs) continue;
      await fs.unlink(full).catch(() => {});
      removed += 1;
    }
    return removed;
  }

  static url(name) {
    return name ? `/uploads/avatars/${name}` : null;
  }
}

ImageService.DIR = DIR;
ImageService.MAX_WIDTH = MAX_WIDTH;
ImageService.MAX_HEIGHT = MAX_HEIGHT;
ImageService.MAX_BYTES = MAX_BYTES;

module.exports = ImageService;
