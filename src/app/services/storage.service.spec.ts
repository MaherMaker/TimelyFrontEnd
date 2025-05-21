import { TestBed } from '@angular/core/testing';
import { StorageService } from './storage.service';

describe('StorageService', () => {
  let service: StorageService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [StorageService]
    });
    service = TestBed.inject(StorageService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should call console.log on set and resolve', async () => {
    spyOn(console, 'log');
    await service.set('testKey', 'testValue');
    expect(console.log).toHaveBeenCalledWith('StorageService (placeholder): set testKey', 'testValue');
  });

  it('should call console.log on get and resolve with null', async () => {
    spyOn(console, 'log');
    const result = await service.get('testKey');
    expect(console.log).toHaveBeenCalledWith('StorageService (placeholder): get testKey');
    expect(result).toBeNull();
  });

  it('should call console.log on remove and resolve', async () => {
    spyOn(console, 'log');
    await service.remove('testKey');
    expect(console.log).toHaveBeenCalledWith('StorageService (placeholder): remove testKey');
  });

  it('should call console.log on clear and resolve', async () => {
    spyOn(console, 'log');
    await service.clear();
    expect(console.log).toHaveBeenCalledWith('StorageService (placeholder): clear');
  });
});
