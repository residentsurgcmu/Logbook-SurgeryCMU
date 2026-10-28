import React from 'react';import {createRoot} from 'react-dom/client';import {SeatMapPanel} from '../src/features/SeatMap';
import '../src/tokens.css';import '../src/styles.css';import '../src/resident.css';import '../src/residentCorner.css';import '../src/seatMap.css';
const role=new URLSearchParams(location.search).get('role')||'staff';
createRoot(document.getElementById('root')).render(<SeatMapPanel user={{id:'fixture-user',role}} />);
