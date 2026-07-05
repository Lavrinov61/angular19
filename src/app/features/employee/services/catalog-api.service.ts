import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ProductCategory {
  id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
  icon: string | null;
  is_active: boolean;
  children?: ProductCategory[];
}

export interface Product {
  id: string;
  category_id: string | null;
  name: string;
  product_type: 'product' | 'service';
  code: string | null;
  barcode: string | null;
  unit: string;
  sell_price: number;
  cost_price: number | null;
  vat_rate: string;
  is_discount_allowed: boolean;
  is_bonus_allowed: boolean;
  is_subscription_eligible: boolean;
  subscription_credit_value: number | null;
  image_url: string | null;
  sort_order: number;
  is_active: boolean;
  is_favorite: boolean;
  category_name?: string;
  stock_quantity?: number | null;
}

@Injectable({ providedIn: 'root' })
export class CatalogApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/catalog';

  getCategories(): Observable<ProductCategory[]> {
    return this.http.get<{ success: boolean; categories: ProductCategory[] }>(`${this.base}/categories`)
      .pipe(map(r => r.categories));
  }

  createCategory(data: Partial<ProductCategory>): Observable<ProductCategory> {
    return this.http.post<{ success: boolean; category: ProductCategory }>(`${this.base}/categories`, data)
      .pipe(map(r => r.category));
  }

  updateCategory(id: string, data: Partial<ProductCategory>): Observable<ProductCategory> {
    return this.http.patch<{ success: boolean; category: ProductCategory }>(`${this.base}/categories/${id}`, data)
      .pipe(map(r => r.category));
  }

  deleteCategory(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/categories/${id}`);
  }

  getProducts(params?: {
    category_id?: string;
    search?: string;
    favorites?: boolean;
    subscription?: boolean;
    type?: string;
    limit?: number;
    offset?: number;
  }): Observable<{ items: Product[]; total: number }> {
    const queryParams: Record<string, string> = {};
    if (params?.category_id) queryParams['category_id'] = params.category_id;
    if (params?.search) queryParams['search'] = params.search;
    if (params?.favorites) queryParams['favorites'] = 'true';
    if (params?.subscription) queryParams['subscription'] = 'true';
    if (params?.type) queryParams['type'] = params.type;
    if (params?.limit) queryParams['limit'] = String(params.limit);
    if (params?.offset) queryParams['offset'] = String(params.offset);

    return this.http.get<{ success: boolean; items: Product[]; total: number }>(`${this.base}/products`, { params: queryParams })
      .pipe(map(r => ({ items: r.items, total: r.total })));
  }

  getProductByBarcode(code: string): Observable<Product | null> {
    return this.http.get<{ success: boolean; product: Product }>(`${this.base}/products/barcode/${code}`)
      .pipe(map(r => r.product));
  }

  createProduct(data: Partial<Product>): Observable<Product> {
    return this.http.post<{ success: boolean; product: Product }>(`${this.base}/products`, data)
      .pipe(map(r => r.product));
  }

  updateProduct(id: string, data: Partial<Product>): Observable<Product> {
    return this.http.patch<{ success: boolean; product: Product }>(`${this.base}/products/${id}`, data)
      .pipe(map(r => r.product));
  }

  deleteProduct(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/products/${id}`);
  }

  importProducts(items: Record<string, unknown>[], mode: 'upsert' | 'create_only' = 'upsert'): Observable<{
    created: number;
    updated: number;
    errors: { row: number; name: string; error: string }[];
  }> {
    return this.http.post<{
      success: boolean;
      created: number;
      updated: number;
      errors: { row: number; name: string; error: string }[];
    }>(`${this.base}/products/import`, { items, mode })
      .pipe(map(r => ({ created: r.created, updated: r.updated, errors: r.errors })));
  }
}
