import { Component, ChangeDetectionStrategy } from '@angular/core';

import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-admin-bookings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatCardModule, MatButtonModule, MatTableModule, RouterLink],
  templateUrl: './admin-bookings.component.html',
  styleUrl: './admin-bookings.component.scss'
})
export class AdminBookingsComponent {
  // Placeholder data for the bookings table
  displayedColumns: string[] = ['date', 'time', 'client', 'service', 'status', 'actions'];
  dataSource = [
    { date: '24.05.2025', time: '10:00', client: 'Иван Петров', service: 'Фото на документы', status: 'Подтверждено' },
    { date: '25.05.2025', time: '14:30', client: 'Анна Сидорова', service: 'Портретная съемка', status: 'Ожидает подтверждения' },
    { date: '26.05.2025', time: '11:45', client: 'Михаил Иванов', service: 'Семейная фотосессия', status: 'Подтверждено' },
  ];
}
