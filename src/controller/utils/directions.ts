type Point = {
    name: string,
    // location: {
    latitude: string,
    longitude: string
    // },
    direction: string
}

export function findDir(nodeOne: Point, nodeTwo: Point, nodeThree: Point): string {
    let dir: string = "keep straight"
    // const theta1 = calcAngle(nodeOne.location, nodeTwo.location);
    const theta1 = calcAngle({latitude: nodeOne.latitude, longitude: nodeOne.longitude}, {latitude: nodeTwo.latitude, longitude: nodeTwo.longitude});

    // const theta2 = calcAngle(nodeTwo.location, nodeThree.location);
    const theta2 = calcAngle({latitude: nodeTwo.latitude, longitude: nodeTwo.longitude}, {latitude: nodeThree.latitude, longitude: nodeThree.longitude});

    const dif = theta2 - theta1;

    if (dif > 0) {
        if (dif < 60) return "slight left";
        if (dif < 110) return "left";
        return "sharp left";
    } else if (dif < 0) {
        if (dif > -60) {
            return "slight right"
        } else if (dif > -110) {
            return "right"
        } else {
            return "sharp right"
        }
    }

    return "straight"; // Optional: Handle cases where `dif === 0`
}

function calcAngle(location1: { latitude: string, longitude: string }, location2: { latitude: string, longitude: string }): number {
    const p1y = parseFloat(location1.latitude);
    const p1x = parseFloat(location1.longitude);
    const p2y = parseFloat(location2.latitude);
    const p2x = parseFloat(location2.longitude);

    if (isNaN(p1y) || isNaN(p1x) || isNaN(p2y) || isNaN(p2x)) {
        throw new Error("Invalid latitude or longitude value");
    }

    const theta = Math.atan2(p2y - p1y, p2x - p1x);
    let thetaDegrees = theta * (180 / Math.PI);
    if (thetaDegrees < 0) {
        thetaDegrees += 360;
    }

    return thetaDegrees;
}
