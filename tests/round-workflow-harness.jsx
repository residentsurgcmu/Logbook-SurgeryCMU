import React from 'react';import {createRoot} from 'react-dom/client';import {RoundAdmin} from '../src/features/RoundAttendance';
import '../src/tokens.css';import '../src/styles.css';import '../src/resident.css';import '../src/residentCorner.css';import '../src/seatMap.css';
createRoot(document.getElementById('root')).render(<RoundAdmin user={{id:'admin',role:'admin'}} />);
