'use strict';

// Rapports et archives (pages d'un village, montées par ./index.js).

const express = require('express');
const ReportService = require('../../../services/ReportService');
const PaginationService = require('../../../services/PaginationService');
const { ah, back, flash } = require('../../middleware');
const { base, me } = require('./shared');

const router = express.Router({ mergeParams: true });

// ------------------------------------------------------------ Rapports

router.get('/reports', ah(async (req, res) => {
  const filter = ReportService.FILTERS.includes(req.query.filter) ? req.query.filter : 'all';
  // ?folder= : un dossier d'archives (premium), « all » pour tout (boîte et archives) ; sinon la boîte de réception.
  const all = req.query.folder === 'all';
  const folder = req.query.folder && !all ? await ReportService.folder(me(req), req.query.folder) : null;
  const [data, folders] = await Promise.all([
    ReportService.list(me(req), { filter, folderId: all ? 'all' : (folder ? folder.id : null), page: req.query.page, perPage: PaginationService.perPage(res.locals.player, 'reports') }),
    ReportService.folders(me(req)),
  ]);
  const { reports, ...pagination } = data;
  res.render('reports', {
    reports, total: data.total, pagination, page: 'reports', filter, folder, all, folders, premium: Boolean(req.ctx.premium),
    keepLimit: ReportService.keepLimit(res.locals.player.villageCount), archiveMonths: ReportService.archiveMonths(res.locals.player),
  });
}));

router.post('/reports/bulk', ah(async (req, res) => {
  let n;
  if (req.body.action === 'read-all') n = await ReportService.markAllRead(me(req));
  else if (req.body.action === 'move') n = await ReportService.move(me(req), req.body.ids, req.body.folder, { premium: req.ctx.premium });
  else n = await ReportService.bulk(me(req), req.body.action, req.body.ids);
  const [one, many] = {
    delete: ['supprimé', 'supprimés'],
    read: ['marqué comme lu', 'marqués comme lus'],
    unread: ['marqué comme non lu', 'marqués comme non lus'],
    'read-all': ['marqué comme lu', 'marqués comme lus'],
    move: req.body.folder ? ['archivé', 'archivés'] : ['remis dans la boîte de réception', 'remis dans la boîte de réception'],
  }[req.body.action];
  flash(req, 'success', n > 1 ? `${n} rapports ${many}.` : `${n} rapport ${one}.`);
  res.redirect(back(req, `${base(req)}/reports`));
}));

// Dossiers d'archives (premium, comme sur Guerre Tribale) : création, renommage, suppression, durée de conservation.
router.get('/reports/folders', ah(async (req, res) => {
  res.render('report-folders', {
    page: 'reports', folders: await ReportService.folders(me(req)), premium: Boolean(req.ctx.premium),
    archiveMonths: ReportService.archiveMonths(res.locals.player), limits: ReportService.ARCHIVE_MONTHS, maxFolders: ReportService.MAX_FOLDERS,
    keepLimit: ReportService.keepLimit(res.locals.player.villageCount),
  });
}));

router.post('/reports/folders', ah(async (req, res) => {
  const folder = await ReportService.createFolder(me(req), req.body.name, { premium: req.ctx.premium });
  flash(req, 'success', `Dossier « ${folder.name} » créé.`);
  res.redirect(`${base(req)}/reports/folders`);
}));

router.post('/reports/folders/:folderId/rename', ah(async (req, res) => {
  await ReportService.renameFolder(me(req), req.params.folderId, req.body.name);
  flash(req, 'success', 'Dossier renommé.');
  res.redirect(`${base(req)}/reports/folders`);
}));

router.post('/reports/folders/:folderId/delete', ah(async (req, res) => {
  await ReportService.deleteFolder(me(req), req.params.folderId);
  flash(req, 'success', 'Dossier supprimé : ses rapports sont revenus dans la boîte de réception.');
  res.redirect(`${base(req)}/reports/folders`);
}));

router.post('/reports/archive-months', ah(async (req, res) => {
  await ReportService.setArchiveMonths(me(req), req.body.months);
  flash(req, 'success', 'Durée de conservation des archives enregistrée.');
  res.redirect(`${base(req)}/reports/folders`);
}));

router.get('/reports/:reportId', ah(async (req, res) => {
  const report = await ReportService.get(me(req), req.params.reportId);
  if (!report.isRead) {
    await report.update({ isRead: true });
    res.locals.unreadReports = Math.max(0, res.locals.unreadReports - 1);
  }
  const [neighbours, folders] = await Promise.all([ReportService.neighbours(me(req), report), ReportService.folders(me(req))]);
  res.render('report', { page: 'reports', report, neighbours, folders, premium: Boolean(req.ctx.premium) });
}));

router.post('/reports/:reportId/move', ah(async (req, res) => {
  await ReportService.move(me(req), [req.params.reportId], req.body.folder, { premium: req.ctx.premium });
  flash(req, 'success', req.body.folder ? 'Rapport archivé.' : 'Rapport remis dans la boîte de réception.');
  res.redirect(`${base(req)}/reports/${Number(req.params.reportId)}`);
}));

router.post('/reports/:reportId/delete', ah(async (req, res) => {
  await ReportService.bulk(me(req), 'delete', [req.params.reportId]);
  flash(req, 'success', 'Rapport supprimé.');
  res.redirect(`${base(req)}/reports`);
}));

module.exports = router;
