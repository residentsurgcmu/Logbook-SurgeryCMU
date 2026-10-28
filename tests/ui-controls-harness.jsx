import React from 'react';import {createRoot} from 'react-dom/client';
import {RoundAdmin} from '../src/features/RoundAttendance';
import ResidentCases from '../src/features/ResidentCases';
import ResidentConference from '../src/features/ResidentConference';
import '../src/tokens.css';import '../src/styles.css';import '../src/resident.css';import '../src/residentCorner.css';import '../src/seatMap.css';
const user={id:'fixture-admin',role:'admin'};
const kind=new URLSearchParams(location.search).get('page');
createRoot(document.getElementById('root')).render(<main className="corner-shell" style={{padding:16,maxWidth:1280,margin:'auto'}}>{kind==='cases'?<ResidentCases user={user}/>:kind==='conference'?<ResidentConference user={user}/>:<RoundAdmin user={user}/>}</main>);
