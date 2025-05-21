import { Component } from '@angular/core';
import { IonicModule } from '@ionic/angular';

@Component({
  selector: 'app-home',
  template: '<ion-header><ion-toolbar><ion-title>Home</ion-title></ion-toolbar></ion-header><ion-content></ion-content>',
  standalone: true,
  imports: [IonicModule]
})
export class HomePage {
  constructor() { }
}
