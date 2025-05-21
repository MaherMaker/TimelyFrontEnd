export interface User {
  id?: number;
  username: string;
  email: string;
  password?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface AuthResponse {
  success: boolean;
  message?: string;
  token?: string; // Access Token
  refreshToken?: string;
  userId?: number;
  username?: string;
  email?: string; // Added email field
}

export interface LoginRequest {
  usernameOrEmail: string;
  password: string;
  deviceId?: string;
}

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
}