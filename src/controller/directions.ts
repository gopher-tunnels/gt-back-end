export function findDirs(data: { name: string, location: { latitude: string, longitude: string }}[]): string[] {
    let dirs: string[] = []
    for (let i = 0; i < data.length - 2; i++) {
        const theta1 = calcAngle(data[i].location, data[i + 1].location);
        const theta2 = calcAngle(data[i + 1].location, data[i + 2].location);
        const dif = theta2 - theta1;
        let name = data[i].name
        if (dif > 0) {
            if (dif < 60) {
                dirs.push('slight left at ' + name)
            } else if (dif < 110) {
                dirs.push('left at' + name)
            } else {
                dirs.push('sharp left at' + name)
            }
        } else if (dif < 0) {
            if (dif > -60) {
                dirs.push('slight right at ' + name) 
            } else if (dif > -110) {
                dirs.push('right at ' + name)
            } else {
                dirs.push('sharp right at ' + name)
            }
        }
    }
    return dirs
}

function calcAngle(location1: { latitude: string, longitude: string }, location2: { latitude: string, longitude: string }): number {
    const [p1y, p1x] = [Number(location1.latitude), Number(location1.longitude)];
    const [p2y, p2x] = [Number(location2.latitude), Number(location2.longitude)];
    const theta = Math.atan2((p2y - p1y), (p2x - p1x));
    let thetaDegrees = theta * 180 / Math.PI;
    if (thetaDegrees < 0) {
        thetaDegrees += 360;
    }
    return thetaDegrees;
}

