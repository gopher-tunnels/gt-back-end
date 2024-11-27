type Point = {
    properties: {
        name: string,
        latitude: string,
        longitude: string
    }
};

export function findDir(nodeOne: Point, nodeTwo: Point, nodeThree: Point): string {
    const theta1 = calcAngle(nodeOne.properties, nodeTwo.properties);
    const theta2 = calcAngle(nodeTwo.properties, nodeThree.properties);
    let dif = theta2 - theta1;
    if (dif > 180) {
        dif -= 360
    } else if (dif < -180) {
        dif += 360
    }
    console.log(theta1, theta2)
    if (-15 < dif && dif < 15) {
        return "straight"
    }
    if (dif > 0) {
        if (dif < 60) return "slight left";
        if (dif < 110) return "left";
        return "sharp left";
    } else if (dif < 0) {
        if (dif > -60) return "slight right";
        if (dif > -110) return "right";
        return "sharp right";
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
