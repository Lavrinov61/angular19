import { Router, Request, Response } from 'express';
import {
  getCategories, getAllCategories, createCategory, updateCategory, deleteCategory,
  getProducts, getProductById, getProductByBarcode, createProduct, updateProduct, deactivateProduct,
  getStock, updateStock, adjustStock, importProducts,
} from '../services/catalog.service.js';
import { authenticateToken, requirePermission, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

// ─── CATEGORIES ───────────────────────────────────────

router.get('/categories', async (_req: Request, res: Response) => {
  const categories = await getCategories();
  res.json({ success: true, categories });
});

router.get('/categories/all', async (_req: Request, res: Response) => {
  const categories = await getAllCategories();
  res.json({ success: true, categories });
});

router.post('/categories', authenticateToken, requirePermission('catalog:manage'), async (req: AuthRequest, res: Response) => {
  const { name, parent_id, sort_order, icon } = req.body;
  if (!name) throw new AppError(400, 'Name is required');
  const category = await createCategory({ name, parent_id, sort_order, icon });
  res.status(201).json({ success: true, category });
});

router.patch('/categories/:id', authenticateToken, requirePermission('catalog:manage'), async (req: AuthRequest, res: Response) => {
  const category = await updateCategory(req.params['id'], req.body);
  if (!category) throw new AppError(404, 'Category not found');
  res.json({ success: true, category });
});

router.delete('/categories/:id', authenticateToken, requirePermission('catalog:manage'), async (req: AuthRequest, res: Response) => {
  const deleted = await deleteCategory(req.params['id']);
  if (!deleted) throw new AppError(404, 'Category not found');
  res.json({ success: true });
});

// ─── PRODUCTS ─────────────────────────────────────────

router.get('/products', async (req: Request, res: Response) => {
  const filters = {
    category_id: req.query['category_id'] as string | undefined,
    search: req.query['search'] as string | undefined,
    active_only: req.query['active_only'] !== 'false',
    favorites_only: req.query['favorites'] === 'true',
    subscription_eligible: req.query['subscription'] === 'true',
    product_type: req.query['type'] as string | undefined,
    limit: req.query['limit'] ? parseInt(req.query['limit'] as string, 10) : undefined,
    offset: req.query['offset'] ? parseInt(req.query['offset'] as string, 10) : undefined,
  };
  const result = await getProducts(filters);
  res.json({ success: true, ...result });
});

router.get('/products/barcode/:code', async (req: Request, res: Response) => {
  const product = await getProductByBarcode(req.params['code']);
  if (!product) throw new AppError(404, 'Product not found');
  res.json({ success: true, product });
});

router.get('/products/:id', async (req: Request, res: Response) => {
  const product = await getProductById(req.params['id']);
  if (!product) throw new AppError(404, 'Product not found');
  res.json({ success: true, product });
});

router.post('/products', authenticateToken, requirePermission('catalog:manage'), async (req: AuthRequest, res: Response) => {
  const { name, sell_price } = req.body;
  if (!name || sell_price === undefined) throw new AppError(400, 'Name and sell_price are required');
  const product = await createProduct(req.body);
  res.status(201).json({ success: true, product });
});

router.patch('/products/:id', authenticateToken, requirePermission('catalog:manage'), async (req: AuthRequest, res: Response) => {
  const product = await updateProduct(req.params['id'], req.body);
  if (!product) throw new AppError(404, 'Product not found');
  res.json({ success: true, product });
});

router.delete('/products/:id', authenticateToken, requirePermission('catalog:manage'), async (req: AuthRequest, res: Response) => {
  const deactivated = await deactivateProduct(req.params['id']);
  if (!deactivated) throw new AppError(404, 'Product not found');
  res.json({ success: true });
});

// ─── IMPORT ──────────────────────────────────────────

router.post('/products/import', authenticateToken, requirePermission('catalog:manage'), async (req: AuthRequest, res: Response) => {
  const { items, mode } = req.body;

  if (!Array.isArray(items) || items.length === 0) throw new AppError(400, 'items array is required');
  if (items.length > 1000) throw new AppError(400, 'Max 1000 items per import');

  const result = await importProducts(items, mode || 'upsert');
  res.json({ success: true, ...result });
});

// ─── STOCK ────────────────────────────────────────────

router.get('/stock/:studioId', async (req: Request, res: Response) => {
  const stock = await getStock(req.params['studioId']);
  res.json({ success: true, stock });
});

router.patch('/stock', authenticateToken, requirePermission('catalog:manage'), async (req: AuthRequest, res: Response) => {
  const { product_id, studio_id, quantity, delta } = req.body;
  if (!product_id || !studio_id) throw new AppError(400, 'product_id and studio_id are required');

  let stock;
  if (delta !== undefined) {
    stock = await adjustStock(product_id, studio_id, delta);
  } else if (quantity !== undefined) {
    stock = await updateStock(product_id, studio_id, quantity);
  } else {
    throw new AppError(400, 'quantity or delta is required');
  }

  res.json({ success: true, stock });
});

export default router;
