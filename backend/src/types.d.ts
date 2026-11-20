import 'express';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        sessionId: number;
        email: string;
        name: string;
        isSuperAdmin: boolean;
        restaurantId: number | null;
        branchId: number | null;
        roleId: number | null;
        roleName: string | null;
        permissions: string[];
        csrfToken: string;
      };
      customer?: {
        sessionId: number;
        restaurantId: number;
        tableId: number | null;
        kind: 'table' | 'online';
        customerId: number | null;
        name: string;
        billId: number | null;
        status: string;
      };
      restaurant?: any;
    }
  }
}
export {};
